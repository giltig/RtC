/* eslint-disable no-console */

const path = require('path');
const webpack = require('webpack');
const AssetsPlugin = require('assets-webpack-plugin');
const nodeExternals = require('webpack-node-externals');
const ExtractTextPlugin = require('extract-text-webpack-plugin');

// @see https://github.com/motdotla/dotenv
const dotenv = require('dotenv');
dotenv.config(process.env.NOW
  // This is to support deployment to the "now" host.  See the README for more info.
  ? { path: './.envnow', silent: true }
  // Standard .env loading.
  : { silent: true }
);

// :: [Any] -> [Any]
function removeEmpty(x) {
  return x.filter(y => !!y);
}

// :: bool -> (Any, Any) -> Any
function ifElse(condition) {
  return (then, or) => (condition ? then : or);
}

// :: ...Object -> Object
function merge() {
  const funcArgs = Array.prototype.slice.call(arguments); // eslint-disable-line prefer-rest-params

  return Object.assign.apply(
    null,
    removeEmpty([{}].concat(funcArgs))
  );
}

function webpackConfigFactory({ target, mode }, { json }) {
  if (!target || !~['client', 'server'].findIndex(valid => target === valid)) {
    throw new Error(
      'You must provide a "target" (client|server) to the webpackConfigFactory.'
    );
  }

  if (!mode || !~['development', 'production'].findIndex(valid => mode === valid)) {
    throw new Error(
      'You must provide a "mode" (development|production) to the webpackConfigFactory.'
    );
  }

  if (!json) {
    // Our bundle is outputing json for bundle analysis, therefore we don't
    // want to do this console output as it will interfere with the json output.
    //
    // You can run a bundle analysis by executing the following:
    //
    // $(npm bin)/webpack \
    //   --env.mode production \
    //   --config webpack.client.config.js \
    //   --json \
    //   > build/client/analysis.json
    //
    // And then upload the build/client/analysis.json to http://webpack.github.io/analyse/
    // This allows you to analyse your webpack bundle to make sure it is
    // optimal.
    console.log(`==> ℹ️  Creating webpack "${target}" config in "${mode}" mode`);
  }

  const isDev = mode === 'development';
  const isProd = mode === 'production';
  const isClient = target === 'client';
  const isServer = target === 'server';

  const ifDev = ifElse(isDev);
  const ifProd = ifElse(isProd);
  const ifClient = ifElse(isClient);
  const ifServer = ifElse(isServer);
  const ifDevClient = ifElse(isDev && isClient);
  const ifDevServer = ifElse(isDev && isServer);
  const ifProdClient = ifElse(isProd && isClient);

  return {
    // We need to state that we are targetting "node" for our server bundle.
    target: ifServer('node', 'web'),
    // We have to set this to be able to use these items when executing a
    // server bundle.  Otherwise strangeness happens, like __dirname resolving
    // to '/'.  There is no effect on our client bundle.
    node: {
      __dirname: true,
      __filename: true,
    },
    // Anything listed in externals will not be included in our bundle.
    externals: removeEmpty([
      // We don't want our node_modules to be bundled with our server package,
      // prefering them to be resolved via native node module system.  Therefore
      // we use the `webpack-node-externals` library to help us generate an
      // externals config that will ignore all node_modules.
      ifServer(nodeExternals({
        // Okay, this is slightly hacky. There are some libraries we want/need
        // webpack to process, therefore we lie to the 'webpack-node-externals'
        // and list these as binaries which will make sure they don't get
        // added to the externals list.
        // If you have a library dependency that depends on a webpack loader
        // then you will need to add it to this list.
        binaryDirs: [
          // We want 'normalize.css' to be processed by our css loader.
          'normalize.css',
        ],
      })),
    ]),
    devtool: ifElse(isServer || isDev)(
      // We want to be able to get nice stack traces when running our server
      // bundle.  To fully support this we'll also need to configure the
      // `node-source-map-support` module to execute at the start of the server
      // bundle.  This module will allow the node to make use of the
      // source maps.
      // We also want to be able to link to the source in chrome dev tools
      // whilst we are in development mode. :)
      'source-map',
      // When in production client mode we don't want any source maps to
      // decrease our payload sizes.
      // This form has almost no cost.
      'hidden-source-map'
    ),
    // Define our entry chunks for our bundle.
    entry: merge(
      {
        main: removeEmpty([
          ifDevClient('react-hot-loader/patch'),
          ifDevClient(`webpack-hot-middleware/client?reload=true&path=http://localhost:${process.env.CLIENT_DEVSERVER_PORT}/__webpack_hmr`),
          path.resolve(__dirname, `./src/${target}/index.js`),
        ]),
      }
    ),
    output: {
      // The dir in which our bundle should be output.
      path: path.resolve(__dirname, `./build/${target}`),
      // The filename format for our bundle's entries.
      filename: ifProdClient(
        // We include a hash for client caching purposes.  Including a unique
        // has for every build will ensure browsers always fetch our newest
        // bundle.
        '[name]-[hash].js',
        // We want a determinable file name when running our server bundles,
        // as we need to be able to target our server start file from our
        // npm scripts.  We don't care about caching on the server anyway.
        // We also want our client development builds to have a determinable
        // name for our hot reloading client bundle server.
        '[name].js'
      ),
      chunkFilename: '[name]-[chunkhash].js',
      // This is the web path under which our webpack bundled output should
      // be considered as being served from.
      publicPath: ifDev(
        // As we run a seperate server for our client and server bundles we
        // need to use an absolute http path for our assets public path.
        `http://localhost:${process.env.CLIENT_DEVSERVER_PORT}/assets/`,
        // Otherwise we expect our bundled output to be served from this path.
        '/assets/'
      ),
      // When in server mode we will output our bundle as a commonjs2 module.
      libraryTarget: ifServer('commonjs2', 'var'),
    },
    resolve: {      
      modules: [path.resolve('./src'), path.resolve('./node_modules')],
      // These extensions are tried when resolving a file.
      extensions: [
        '.js',
        '.jsx',
        '.json',
      ],
    },
    plugins: removeEmpty([
      // Each key passed into DefinePlugin is an identifier.
      // The values for each key will be inlined into the code replacing any
      // instances of the keys that are found.
      // If the value is a string it will be used as a code fragment.
      // If the value isn’t a string, it will be stringified (including functions).
      // If the value is an object all keys are removeEmpty the same way.
      // If you prefix typeof to the key, it’s only removeEmpty for typeof calls.
      new webpack.DefinePlugin({
        'process.env': {
          // NOTE: The NODE_ENV key is especially important for production
          // builds as React relies on process.env.NODE_ENV for optimizations.
          NODE_ENV: JSON.stringify(mode),
          // All the below items match the config items in our .env file. Go
          // to the .env_example for a description of each key.
          SERVER_PORT: JSON.stringify(process.env.SERVER_PORT),
          CLIENT_DEVSERVER_PORT: JSON.stringify(process.env.CLIENT_DEVSERVER_PORT),
          DISABLE_SSR: process.env.DISABLE_SSR,
          WEBSITE_TITLE: JSON.stringify(process.env.WEBSITE_TITLE),
          WEBSITE_DESCRIPTION: JSON.stringify(process.env.WEBSITE_DESCRIPTION),
        },
      }),

      // Generates a JSON file containing a map of all the output files for
      // our webpack bundle.  A necessisty for our server rendering process
      // as we need to interogate these files in order to know what JS/CSS
      // we need to inject into our HTML.
      new AssetsPlugin({
        filename: 'assets.json',
        path: path.resolve(__dirname, `./build/${target}`),
      }),

      // We don't want webpack errors to occur during development as it will
      // kill our dev servers.
      ifDev(new webpack.NoErrorsPlugin()),

      // We need this plugin to enable hot module reloading for our dev server.
      ifDevClient(new webpack.HotModuleReplacementPlugin()),

      // Ensure only 1 file is output for the server bundles.  This makes it
      // much easer for us to clear the module cache when reloading the server.
      ifDevServer(new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })),

      // Adds options to all of our loaders.
      ifProdClient(
        new webpack.LoaderOptionsPlugin({
          // Indicates to our loaders that they should minify their output
          // if they have the capability to do so.
          minimize: true,
          // Indicates to our loaders that they should enter into debug mode
          // should they support it.
          debug: false,
        })
      ),

      ifProdClient(
        // JS Minification.
        new webpack.optimize.UglifyJsPlugin({
          compress: {
            screw_ie8: true,
            warnings: false,
          },
        })
      ),

      ifProd(
        // This is actually only useful when our deps are installed via npm2.
        // In npm2 its possible to get duplicates of dependencies bundled
        // given the nested module structure. npm3 is flat, so this doesn't
        // occur.
        new webpack.optimize.DedupePlugin()
      ),

      ifProdClient(
        // This is a production client so we will extract our CSS into
        // CSS files.
        new ExtractTextPlugin({ filename: '[name]-[chunkhash].css', allChunks: true })
      ),
    ]),
    module: {
      loaders: [
        // Javascript
        {
          test: /\.jsx?$/,
          loader: 'babel-loader',
          exclude: [/node_modules/, path.resolve(__dirname, './build')],
          query: merge(
            {
              env: {
                development: {
                  plugins: ['react-hot-loader/babel'],
                },
              },
            },
            ifServer({              
              presets: ['react', 'es2015-webpack', 'stage-0'],
            }),
            ifClient({
              // For our clients code we will need to transpile our JS into
              // ES5 code for wider browser/device compatability.
              presets: [
                // JSX
                'react',
                // Webpack 2 includes support for es2015 imports, therefore we used this
                // modified preset.
                'es2015-webpack',
                'stage-0',
              ],
            })
          ),
        },

        // JSON
        {
          test: /\.json$/,
          loader: 'json-loader',
        },

        // Images and Fonts
        {
          test: /\.(jpg|jpeg|png|gif|eot|svg|ttf|woff|woff2)$/,
          loader: 'url-loader',
          query: {
            // Any file with a byte smaller than this will be "inlined" via
            // a base64 representation.
            limit: 10000,
          },
        },

        // CSS
        merge(
          { test: /\.css$/ },
          // When targetting the server we fake out the style loader as the
          // server can't handle the styles and doesn't care about them either..
          ifServer({
            loaders: [
              'fake-style-loader',
              'css-loader',
            ],
          }),
          // For a production client build we use the ExtractTextPlugin which
          // will extract our CSS into CSS files.  The plugin needs to be
          // registered within the plugins section too.
          ifProdClient({
            loader: ExtractTextPlugin.extract({
              notExtractLoader: 'style-loader',
              loader: 'css-loader',
            }),
          }),
          // For a development client we will use a straight style & css loader
          // along with source maps.  This combo gives us a better development
          // experience.
          ifDevClient({
            loaders: [
              'style-loader',
              { loader: 'css-loader', query: { sourceMap: true } },
            ],
          })
        ),
        // SCSS
        merge(
          { test: /\.scss$/ },
          // When targetting the server we fake out the style loader as the
          // server can't handle the styles and doesn't care about them either..
          ifServer({
            loaders: [
              'fake-style-loader',
              'css-loader',
              'sass-loader'
            ],
          }),
          // For a production client build we use the ExtractTextPlugin which
          // will extract our CSS into CSS files.  The plugin needs to be
          // registered within the plugins section too.
          ifProdClient({
            loader: ExtractTextPlugin.extract({
              notExtractLoader: 'style-loader',
              loader: ['css-loader', 'sass-loader'],
            }),
          }),
          // For a development client we will use a straight style & css loader
          // along with source maps.  This combo gives us a better development
          // experience.
          ifDevClient({
            loaders: [
              'style-loader',
              'css?sourceMap',
              'sass?sourceMap'
            ],
          })
        ),
      ],
    },
  };
}

module.exports = webpackConfigFactory;
